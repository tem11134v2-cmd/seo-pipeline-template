# ADR-008: Расшаривание стратегий через якорь-папки в Google Drive

**Статус:** Принято

**Дата:** 2026-05-26

## Контекст

После того как `/strategy` собирает локально `SEO_Strategy_<slug>.docx` (для клиента) и `Smeta_<slug>.xlsx` (внутренний), их нужно отдать клиенту по ссылке. В claude.ai-версии файлы рядом с чатом висели прямо в браузере. В Claude Code такого нет - файлы лежат локально, отправлять их клиенту неудобно: вложение по почте, мессенджер, ручной upload в Drive каждый раз.

Хотелось: одна команда `/share-strategy <NNN>` → файлы появляются в Drive, на руки две публичные ссылки.

В стеке стоит локальный MCP `gdrive-piotr` (пакет `@piotr-agier/google-drive-mcp@2.2.0`, установлен через `npm install -g`). MCP даёт полный набор тулов Drive: `uploadFile`, `listPermissions`, `deleteItem`, `createFolder` и др. Прошли OAuth, токены сохранены, `uploadFile` работает.

**Проблема:** у пакета баг в инструменте `addPermission`. Схема валидатора `AddPermissionSchema` строго требует `emailAddress` (`z.string().email("Valid email is required")`), но Google API запрещает `emailAddress` при `type: anyone`. Любой реальный вход отказывается:
- Пустой email → MCP-валидатор: «Valid email is required».
- Любой валидный email → Google API: «emailAddress is invalid or not applicable for the given permission type».

То есть установить «anyone with link → reader» через MCP **программно нельзя**.

## Решение

**Якорь-папки в Drive, расшаренные один раз вручную.**

Заводим в Drive **две папки**, разделение по типу файла:
- **«Стратегии»** - для `SEO_Strategy_*.docx` (клиентские документы)
- **«Сметы»** - для `Smeta_*.xlsx` (внутренние, с ценами)

Каждая папка через Drive Web UI один раз расшаривается «anyone with link → reader». ID папок записаны в `~/.claude/seo-knowledge/DRIVE.md`.

Скил `/share-strategy <NNN>`:
1. Читает `DRIVE.md`, получает ID обеих папок.
2. Вызывает `mcp__gdrive-piotr__uploadFile(localPath=..., parentFolderId=<ID папки>, convertToGoogleFormat=false)` для каждого файла.
3. **Файл наследует права папки автоматически** - сразу публично-просматриваемый.
4. Сохраняет ссылки в `<strategy_dir>/share.json`, выводит в чат.

`convertToGoogleFormat: false` гарантирует, что `.docx` остаётся `.docx`, а `.xlsx` остаётся `.xlsx` (формулы SUM в Excel сохраняются точно).

Smoke-тест подтвердил: `listPermissions` на загруженном файле показывает `anyoneWithLink: anyone => reader [inherited]` - наследование работает.

## Альтернативы

### A. Локальный патч `addPermission` в `dist/index.js` пакета

Поправить две вещи в `node_modules/@piotr-agier/google-drive-mcp/dist/index.js`:
1. В `AddPermissionSchema`: `.email()` → `.optional()` + условный `superRefine`.
2. В обработчике `case "addPermission"`: передавать `emailAddress` в Google API только если `type !== "anyone"`.

Отвергнуто:
- Затрётся при `npm update -g @piotr-agier/google-drive-mcp`.
- Классификатор Claude Code блокирует правки в `node_modules` без явного одобрения - каждый раз новое подтверждение.
- Решает только текущий проявившийся баг. В пакете могут вылезти другие.

### B. Подменить MCP на Composio Drive

Зарегистрироваться на composio.dev, подключить Google Drive через их dashboard, получить MCP URL, прописать в `claude_desktop_config.json`. Composio документированно поддерживает `Create Permission` с `type=anyone`.

Отвергнуто:
- У пользователя ошибки на странице регистрации Composio - не открывается консоль.
- Лишний коммерческий сервис в стеке.
- Зависимость от их доступности.

### C. Свой мини-MCP только под permission

Написать собственный stdio-MCP с одним тулом `gdrive_make_public(fileId)`, использующий тот же OAuth refresh token. Параллельно с piotr-MCP.

Отвергнуто **на этом этапе** (можно вернуться, если потребуются гибкие per-file права):
- 100-150 строк кода поддержки.
- Решает только текущую задачу - расшаривание. Не даёт ничего сверху.
- Якорь-папки решают 95% сценария без всего этого.

### D. Per-client папки вместо per-type

Один раз вручную - папка `TIMUR SEO / Стратегии / <domain> /` под каждого клиента. Внутри и .docx, и .xlsx.

Отвергнуто:
- Требует этапа в скиле «найти существующую или создать новую папку клиента» - усложнение для редкого сценария (один клиент = одна стратегия обычно).
- При расшаривании папки клиента клиент получает доступ и к смете тоже (хотя смета внутренняя).
- Разделение по типу проще читается в Drive Web UI («все стратегии в одной папке - один список»).

### E. Без MCP, через Google Drive for Desktop sync

Установить Drive Desktop, симлинк `~/Google Drive/My Drive/Стратегии/` ↔ `~/seo-projects/<client>/strategies/`. Файлы синкаются автоматически.

Отвергнуто:
- Нужно ставить и настраивать Drive Desktop на каждой машине разработчика.
- Синк двусторонний - случайные правки в Drive затирают локальные.
- Файлы в Drive окажутся в персональной папке аккаунта Drive Desktop, а не в TIMUR SEO структуре - не подходит для шаринга клиенту.

## Последствия

**Хорошо:**

- `/share-strategy <NNN>` - одна команда → две ссылки. Заявленный UX достигнут.
- `addPermission` MCP вообще не используется - баг не блокирует.
- Файлы группируются по типу: `Стратегии .docx/` и `Сметы .xlsx/`. Удобно при ревизии за квартал.
- `convertToGoogleFormat: false` - клиент получает оригинальный `.docx`, формулы в смете не пересчитываются Sheets-движком.
- Идемпотентно: `--redo` удаляет старые версии и грузит заново. `share.json` хранит истории drive_id.
- Расширяемо: позже можно добавить `/share-strategy <NNN> --to-email=client@...` через `shareFile` (этот тул работает корректно, проверен).

**Плохо:**

- Расшаренность всех файлов завязана на права папки-якоря. Если случайно убрать «anyone with link» с папки - все ранее загруженные стратегии тоже потеряют публичность. Решение: документировано в `DRIVE.md` («что НЕ делать»).
- Один Google-аккаунт `tem11134v2@gmail.com` - все клиенты идут через него. Если когда-то понадобится изоляция (разные аккаунты для разных клиентов / компаний) - архитектура усложнится.
- Конкретные ID папок в `DRIVE.md`. Если папки переедут (удаление / новое имя) - надо обновить файл. Это разовая операция, но не автоматическая.
- При первом ошибочном Drive-аккаунте OAuth (например, залогинились не туда) - надо переавторизоваться: удалить `~/.config/google-drive-mcp/tokens.json` и запустить `google-drive-mcp.cmd auth` заново.

## Ссылки

- Пакет MCP: https://github.com/piotr-agier/google-drive-mcp
- Баг в `addPermission` - воспроизводится на v2.2.0 (текущая). Открыть issue / PR upstream - в планах.
- Файл якорей: `~/.claude/seo-knowledge/DRIVE.md`.
- Скил: `.claude/skills/share-strategy/SKILL.md`.
- [ADR-004](004-global-mcp-and-knowledge.md) - почему DRIVE.md лежит в global `seo-knowledge`.
- [ADR-007](007-strategy-task-type.md) - откуда взялись `strategies/NNN/` папки.
