---
name: strategy
description: Полный цикл SEO-стратегии для клиента. Скан сайта → метрики → конкуренты → точки роста → три тарифа → стратегия .docx (без цен) и смета .xlsx (с ценами). Аргументы: <URL> [--resume].
---

# strategy

Скил-оркестратор формирования стратегии и сметы. Запускается **в worktree-сессии**. Проходит state machine от скана сайта до сборки docx/xlsx.

## Аргументы

```
/strategy <URL> [--resume]
```

- `URL` — обязательный позиционный. Домен клиента в формате `https://site.ru/` или `site.ru`. Если у клиента нет сайта — передать `none`, скил спросит дополнительные данные.
- `--resume` — продолжить с того места, где остановилось (по `meta.json`).

## State machine

```
init → scan-done → competitors-done → growth-done →
  tariffs-done → content-done → docx-done → xlsx-done → shared → completed
```

`meta.json` — единственный источник истины. Обновляется через `.claude/hooks/update-meta.sh <strategy_dir> <state>`.

## Алгоритм

### 0a. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` — мы в main. Предупредить:
> «⚠️ Ты собираешь стратегию в main-сессии. Pre-commit hook здесь не блокирует. Для многозадачности рекомендую закрыть и переоткрыть с галочкой worktree.»

Не блокировать — пользователь может сознательно так захотеть.

### 0b. Parse args

```
URL = <обязательно>
resume = true если --resume
domain = normalize(URL)  // убрать https://, www., trailing slash, нижний регистр
slug = slugify(domain)   // vasya.ru → vasya-ru; none → no-site-<timestamp>
```

### 1. Setup

Спроси пользователя (если не указано в аргументе):
- Регион продвижения (например «Санкт-Петербург»)
- Ниша / описание бизнеса (1-2 предложения)
- Есть ли доступ к Вебмастеру и Метрике на аккаунт tem11134? (Y/n)
- Бюджет клиента, если озвучен (опц.)
- Заметки и пожелания (опц.)

**Если `URL == none` (домена нет — нужен запуск с нуля)** — дополнительно спроси:
- Главный целевой запрос или маркер ниши (1-2 шт., например «ремонт квартир спб»)
- Известные конкуренты, на которых хочется равняться (1-3 домена, опц.)

Эти данные нужны competitor-analyst для пути Г (генерация маркеров «<услуга> <город>») и growth-strategist для частотных таблиц. Запиши их в `inputs.json` как поля `seed_queries: [...]` и `seed_competitors: [...]`.

Определи `region_id` (Wordstat) и `keyso_base`:

```
region_id (Wordstat): Москва: 213 | СПб: 2 | Екатеринбург: 54 | Новосибирск: 65
  Казань: 43 | Н.Новгород: 47 | Челябинск: 56 | Самара: 51
  Ростов: 39 | Краснодар: 35 | Воронеж: 193 | Уфа: 172
  Пермь: 50 | Омск: 66 | Волгоград: 38 | Красноярск: 62
  (не в списке) → ближайший крупный или null

keyso_base: msk | spb | ekb | nsk | kzn | nnv | che | sam | rnd | krr | vrn | vlg | ufa | prm | kry | oms | sar | tmn | tom | mns
  (не совпадает) → msk + флаг city_not_in_keyso=true
```

Подготовь папку:
```
strategy_dir = strategies/<NNN>-<slug>/
```
Где NNN — следующий свободный двузначный/трёхзначный номер с ведущим нулём (отсчёт от существующих папок в `strategies/`, если папки нет — 001).

Если `--resume`:
- Найти существующую `strategies/NNN-<slug>/` (по slug или по NNN если указан).
- Прочитать `meta.json`. `state = meta.state`.
- Спросить: «Найдено в состоянии `<state>`, last_completed=`<...>`. Продолжить? [Y/n]»
- Если Y — перейти к ветке от следующего шага после `state`.

Иначе:
- Создать `<strategy_dir>/`.
- Записать `<strategy_dir>/inputs.json`:
```json
{
  "domain": "site.ru",
  "slug": "site-ru",
  "url_raw": "https://site.ru/",
  "niche": "...",
  "region": "Санкт-Петербург",
  "region_id": 2,
  "keyso_base": "spb",
  "city_not_in_keyso": false,
  "access_webmaster": true,
  "access_metrika": true,
  "budget": null,
  "notes": "",
  "date": "Май 2026"
}
```

`slug` — Latin-only kebab-case (для IDN-доменов вроде `сайт.рф` нужен явный slug, иначе генерация имён файлов даст некрасивый результат). Скрипты `build-strategy-docx.mjs` и `build-smeta-xlsx.mjs` используют `slug` для имени файла, иначе fallback на `domain`.
- Записать `<strategy_dir>/meta.json`:
```json
{
  "domain": "site.ru",
  "slug": "site-ru",
  "state": "init",
  "completed_steps": [],
  "started": "<ISO UTC>",
  "updated": "<ISO UTC>"
}
```
- Записать `.claude/tmp/current-task.txt` с путём `<strategy_dir>` (критично — без этого pre-commit откажет в коммите).
- `state = "init"`.

### 2. Скан + метрики (если state == "init")

Маркер: `.claude/tmp/expected-strategy-scanner-<run_id>.txt = <strategy_dir>/metrics.json`

Делегировать `strategy-scanner`:
```
strategy_dir: <strategy_dir>
inputs_path: <strategy_dir>/inputs.json
project_root: <project root>
Прочитай inputs.json, MCP_MAP.md. Сделай скан сайта (если есть домен), собери метрики клиента, доп. техчек. Сохрани scan.json и metrics.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> scan-done`
- Вывести сводку (агент уже вывел). Сразу переходить к шагу 3.

### 3. Конкуренты + вердикт (если state == "scan-done")

Маркер: `.claude/tmp/expected-competitor-analyst-<run_id>.txt = <strategy_dir>/competitors.json`

Делегировать `competitor-analyst`:
```
strategy_dir: <strategy_dir>
project_root: <project root>
Прочитай inputs.json, scan.json, metrics.json, MCP_MAP.md. Найди прямые конкуренты (5-8) и ориентиры (2-3), проанализируй выдачу, сформулируй вердикт. Сохрани competitors.json и serp.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> competitors-done`
- Сводка — есть. Переход к шагу 4.

### 4. Точки роста + strategy_data.json (если state == "competitors-done")

Маркер: `.claude/tmp/expected-growth-strategist-<run_id>.txt = <strategy_dir>/strategy_data.json`

Делегировать `growth-strategist`:
```
strategy_dir: <strategy_dir>
project_root: <project root>
Прочитай все JSON из <strategy_dir>, TARIFFS.md, schema. Сформулируй 3-6 точек роста с проверкой частотности Wordstat, Quick Wins (2-3), прогноз для тарифа Рост. Собери strategy_data.json по схеме (поле tariffs пусто).
```

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> growth-done`
- Сводка анализа выведена в чат — это «итог Шага 1» в терминологии исходного скила. Переход сразу к подбору тарифов.

### 5. Тарифы (если state == "growth-done")

Маркер: `.claude/tmp/expected-tariff-architect-<run_id>.txt = <strategy_dir>/tariffs.json`

Делегировать `tariff-architect`:
```
strategy_dir: <strategy_dir>
project_root: <project root>
Прочитай strategy_data.json, TARIFFS.md, RULES.md. Собери три тарифа Старт/Рост/Максимум по правилам и развилкам. Посчитай корректировки прогноза. Сохрани tariffs.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> tariffs-done`
- Сводка тарифов выведена. Переход к контенту.

### 6. Контент стратегии (если state == "tariffs-done")

Маркер: `.claude/tmp/expected-strategy-writer-<run_id>.txt = <strategy_dir>/strategy_content.json`

Делегировать `strategy-writer`:
```
strategy_dir: <strategy_dir>
project_root: <project root>
Прочитай strategy_data.json, tariffs.json, TARIFFS.md. Сформируй прозу для 6 разделов стратегии (без цен в разделе 4). Сохрани strategy_content.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> content-done`

### 7. Сборка docx (если state == "content-done")

```
.claude\scripts\_node.cmd .claude\scripts\build-strategy-docx.mjs <strategy_dir>
```

Скрипт читает `strategy_content.json` + `tariffs.json` + `inputs.json`, генерирует `<strategy_dir>/SEO_Strategy_<domain>.docx`.

`bash .claude/hooks/update-meta.sh <strategy_dir> docx-done`

### 8. Сборка xlsx (если state == "docx-done")

```
.claude\scripts\_node.cmd .claude\scripts\build-smeta-xlsx.mjs <strategy_dir>
```

Скрипт читает `tariffs.json` + `inputs.json`, генерирует `<strategy_dir>/Smeta_<domain>.xlsx` (3 вкладки Старт/Рост/Максимум, формулы SUM).

`bash .claude/hooks/update-meta.sh <strategy_dir> xlsx-done`

### 9. Загрузка в Google Drive (если state == "xlsx-done")

Финальные .docx и .xlsx грузим в Drive с **автоконверсией в Google Workspace** — команда сразу редактирует/комментирует в браузере. Локальные файлы остаются как резерв-оригинал.

**Предусловие:** MCP `gdrive-piotr` подключён глобально, OAuth пройден один раз. См. ADR-008.

#### 9a. Прочитать конфиг папок

`~/.claude/seo-knowledge/DRIVE.md` — извлечь ID двух якорь-папок:
- `strategies_folder_id` — папка для стратегий (расшарена «anyone with link → reader»)
- `smety_folder_id` — папка для смет (то же самое)

Если файл DRIVE.md не существует или ID не находятся — пропустить весь шаг 9, перейти к шагу 10 с пометкой в meta `share_skipped: "drive_config_missing"`. Пользователю в финальном выводе сообщить, что Drive-загрузка пропущена.

#### 9b. Загрузить стратегию (.docx → Google Doc)

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к SEO_Strategy_<slug>.docx>,
  name: SEO_Strategy_<slug>,
  parentFolderId: <strategies_folder_id>,
  convertToGoogleFormat: true
)
```

**`convertToGoogleFormat: true`** — Google Drive автоматически превратит .docx в нативный Google Doc. Команда открывает в браузере, может комментировать, редактировать совместно, делиться через стандартные Google-механизмы.

Из ответа сохранить: `id`, `link` (viewLink).

#### 9c. Загрузить смету (.xlsx → Google Sheet)

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к Smeta_<slug>.xlsx>,
  name: Smeta_<slug>,
  parentFolderId: <smety_folder_id>,
  convertToGoogleFormat: true
)
```

Формулы `=SUM(E5:E10)` корректно конвертируются в Google Sheets. Форматирование Arial и тёмно-синие заголовки сохранятся.

#### 9d. Записать share.json

`<strategy_dir>/share.json`:
```json
{
  "shared_at": "<ISO UTC>",
  "shared_by": "tem11134v2@gmail.com",
  "converted": true,
  "strategy": {
    "filename": "SEO_Strategy_<slug>",
    "drive_id": "<id>",
    "view_link": "<viewLink>",
    "parent_folder_id": "<strategies_folder_id>",
    "mime_type": "application/vnd.google-apps.document"
  },
  "smeta": {
    "filename": "Smeta_<slug>",
    "drive_id": "<id>",
    "view_link": "<viewLink>",
    "parent_folder_id": "<smety_folder_id>",
    "mime_type": "application/vnd.google-apps.spreadsheet"
  }
}
```

#### 9e. Обновить meta

`bash .claude/hooks/update-meta.sh <strategy_dir> shared`

#### Что делать при ошибке Drive-загрузки

Если MCP не отвечает, OAuth протух, или вернулась ошибка — **не блокировать `/strategy`**. Локальные файлы и так готовы. Действия:
1. Записать в `meta.json` поле `share_error: "<краткое описание>"` (через update-meta или вручную через Edit).
2. НЕ переходить в `shared` — оставить state `xlsx-done`.
3. В шаге 10 сообщить пользователю: «Локально готово. Расшаривание в Drive не удалось (причина). Запусти `/share-strategy <NNN>` отдельно после исправления.»

Это даёт устойчивость: даже если Drive временно недоступен, стратегия не теряется.

### 10. Финал (если state == "shared" или state == "xlsx-done")

`bash .claude/hooks/update-meta.sh <strategy_dir> completed`

Финальный коммит в worktree-ветку:
```
git add -A
git commit -m "Strategy <NNN> for <domain>: completed"
```

Если шаг 9 прошёл успешно (`state` был `shared` перед `completed`), вывести:
```
═══ СТРАТЕГИЯ ГОТОВА ═══

Клиент: <domain>

📄 Стратегия (Google Doc, для команды и клиента):
   <view_link>

📊 Смета (Google Sheet, внутренняя, с ценами):
   <view_link>

Оба файла доступны по ссылке любому без логина (anyone with link → reader),
команда может редактировать и комментировать прямо в браузере.

Локальные оригиналы (резерв):
   <strategy_dir>/SEO_Strategy_<slug>.docx
   <strategy_dir>/Smeta_<slug>.xlsx

Данные анализа: <strategy_dir>/strategy_data.json
Тарифы:         <strategy_dir>/tariffs.json
Ссылки:         <strategy_dir>/share.json

⚠️ НЕ ЗАБУДЬ /handoff перед закрытием сессии — иначе файлы останутся
   в worktree и не попадут в основную папку проекта.
═══════════════════════
```

Если шаг 9 был пропущен (`state` остался `xlsx-done`) — вывести fallback:
```
Готово локально. Drive-расшаривание не выполнено.
Причина: <из meta.share_error / share_skipped>

Локальные файлы:
   <strategy_dir>/SEO_Strategy_<slug>.docx
   <strategy_dir>/Smeta_<slug>.xlsx

Когда исправишь Drive (см. README troubleshooting), запусти:
   /share-strategy <NNN>

⚠️ /handoff также не забыть.
```

## Параллельная работа

Несколько стратегий одновременно — каждая в своём worktree:
```
claude --worktree strat-002
```

Состояния не пересекаются.

## Запреты

- НЕ пиши результаты в корень проекта (никакого `SEO_Strategy_*.docx` в корне) — только в `<strategy_dir>/`. Иначе pre-commit отклонит.
- НЕ пропускай состояния — каждое `update-meta.sh` обязательно.
- НЕ редактируй методологию (TARIFFS.md, RULES.md) — это `~/.claude/seo-knowledge/`, read-only.
- НЕ используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ делай `git push` и не публикуй артефакты — это решение пользователя.
- НЕ запускай `/write-article`, `/new-topics` из этой же сессии — это отдельные worktree-задачи.
