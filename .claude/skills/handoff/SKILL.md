---
name: handoff
description: Финализирует worktree-задачу. Делает финальный коммит, мержит ветку в main, удаляет ветку и пробует удалить worktree. Содержимое handoff-requests попадает в main для последующей обработки через /handoff-process.
---

# handoff

Завершает работу в worktree-сессии: финальный коммит → merge → cleanup. После этого все файлы задачи (включая `.claude/handoff-requests/`) лежат в main.

## Аргументы

```
/handoff [--message "<сообщение коммита>"] [--resume]
```

- `--message` — переопределить auto-message для финального коммита.
- `--resume` — продолжить после ручного разрешения конфликта merge.

## Алгоритм

### 0. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` (в main) — отказать:
> «/handoff работает только в worktree. В main нет ничего что мерджить — используй /handoff-process для обработки накопленных запросов.»

### 1. Узнать параметры

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Путь к main worktree
COMMON_DIR_ABS=$(git rev-parse --git-common-dir)
case "$COMMON_DIR_ABS" in
  /*|[a-zA-Z]:*) ;;
  *) COMMON_DIR_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR_ABS" && pwd) ;;
esac
MAIN_WT=$(dirname "$COMMON_DIR_ABS")

# Базовая ветка main worktree (master / main / другая)
BASE_BRANCH=$(git -C "$MAIN_WT" rev-parse --abbrev-ref HEAD)

if [ "$BASE_BRANCH" = "$CURRENT_BRANCH" ]; then
  echo "Аномалия: main worktree на той же ветке ($CURRENT_BRANCH), что и текущая. /handoff отказывает."
  exit
fi
```

Сообщить пользователю:
> «Handoff: `<CURRENT_BRANCH>` → `<BASE_BRANCH>` в `<MAIN_WT>`».

### 1.5. Проверка незавершённых анализов

Если в задаче есть `analyses/NNN-*/meta.json` со state `report-done`, `docx-done`, `shared`, `client-review` или `revising` — это значит анализ не дошёл до одобрения клиентом.

Прочитать `.claude/tmp/current-task.txt`. Если содержит путь `analyses/NNN-*/`, прочитать meta.json. Если state ∈ {report-done, docx-done, shared, client-review, revising}:

> ⚠️ Анализ `analyses/<NNN>-<slug>/` в состоянии `<state>` — не одобрено клиентом.
>
> Точно делаешь /handoff? Варианты:
>   [Y] — да, сдать как есть (клиент потом одобрит / у меня нет связи с ним)
>   [n] — нет, сначала довести до approved (вернуться в скил)
>   [skip] — да, и пропустить эту проверку для остальных задач в worktree

Если N — стоп. Если Y или skip — продолжить как обычно.

Если state == `approved` или `completed` — без warning, продолжать.

### 2. Финальный коммит (auto)

**Серийный режим (несколько статей в одной worktree).** Если задача - батч статей
(`/seo-statya 11-20`), в `current-task.txt` несколько строк - по папке на статью.
Pre-commit hook (Block D) разрешает коммит файлов всех перечисленных задач разом, без
`--no-verify`. Перед коммитом обнови производный индекс (для пост-merge проверки ниже):

```
.claude\scripts\_node.cmd .claude\scripts\rebuild-index.mjs articles
```

(`_index.json` gitignored - не коммитится, это локальный кеш.)

Если `git status --porcelain` непуст:

1. Сформировать сообщение:
   - Если передан `--message` — использовать его.
   - Иначе — попробовать вытащить контекст:
     - Прочитать `.claude/tmp/current-task.txt` → определить тип задачи (articles/NNN, handoff-requests/setup, handoff-requests/topics).
     - Если `articles/NNN/meta.json` существует — вытащить slug и state: `Article <slug>: <state>`.
     - Если задача = setup-project: `Setup project: investigate site, generate ЗАКАЗЧИК.md + template.html`.
     - Если задача = new-topics: `New topics: collected N items`.
     - Иначе: `Worktree handoff: <CURRENT_BRANCH>`.
2. Закоммитить:
   ```bash
   git add -A
   git commit -m "<сообщение>"
   ```

   Pre-commit hook сработает. Если упадёт (запрещённые файлы) — остановить handoff, попросить пользователя:
   > «Pre-commit отказал. Используй /request-shared-edit для общих файлов или git restore для отката.»

### 3. Merge в main

**Снимок до merge (страховка для серии, Block D):** запомни число статей в main, чтобы
после merge убедиться, что ни одна ранее завершённая статья не пропала:

```bash
BEFORE=$(ls -d "$MAIN_WT"/articles/*/ 2>/dev/null | wc -l)
```

```bash
git -C "$MAIN_WT" checkout "$BASE_BRANCH"
git -C "$MAIN_WT" merge "$CURRENT_BRANCH" --no-ff -m "Handoff: $CURRENT_BRANCH"
```

**Если конфликт:**
- Сообщить пользователю:
  > «Конфликт при merge `<CURRENT_BRANCH>` → `<BASE_BRANCH>`. Файлы: [список из `git status` в `$MAIN_WT`].
  > Открой `<MAIN_WT>` в отдельной сессии (без worktree), разреши конфликт вручную (git status / git diff / git add / git commit). После этого вернись сюда и запусти `/handoff --resume` — я доделаю удаление ветки и worktree.»
- **Остановиться. Не удалять worktree.**

Если merge прошёл — продолжить.

**Пост-merge проверка (Block D):** число статей в main не должно уменьшиться.

```bash
AFTER=$(ls -d "$MAIN_WT"/articles/*/ 2>/dev/null | wc -l)
```

Если `AFTER < BEFORE` - **стоп, не удалять worktree**: merge что-то затёр (аномалия,
обычно так не бывает - статьи это отдельные папки). Сообщи пользователю числа и попроси
проверить `git -C "$MAIN_WT" log --oneline -5` и `git -C "$MAIN_WT" status` вручную, прежде
чем удалять ветку. Если `AFTER >= BEFORE` - всё штатно, продолжить.

### 4. Удаление ветки и worktree

⚠️ Порядок: сначала worktree-метаданные, потом ветка (git не даст удалить ветку, используемую worktree).

⚠️ `--force` обязательно: в worktree всегда есть untracked файлы из gitignore (`.claude/tmp/`, `node_modules/`), без `--force` git откажет.

```bash
# Сначала удалить worktree из git-метаданных (с --force)
git -C "$MAIN_WT" worktree remove --force "$PROJECT_ROOT" || true

# Если папка осталась на диске (Windows file lock) — пробуем prune
git -C "$MAIN_WT" worktree prune

# Удалить ветку
git -C "$MAIN_WT" branch -d "$CURRENT_BRANCH" || git -C "$MAIN_WT" branch -D "$CURRENT_BRANCH"
```

Если `worktree remove --force` упал с `Permission denied` (типично для Windows — индексатор держит файлы):
- Это **не критично** — merge уже прошёл, данные в main.
- `git worktree prune` уберёт git-метаданные.
- Папка на диске останется зомби, удалится при следующем `/handoff-process` или вручную.

### 5. `--resume` (после ручного разрешения конфликта)

Если запущен с `--resume`:
- Пропустить шаги 2-3 (commit и merge уже сделаны пользователем вручную в main).
- Проверить: `git -C "$MAIN_WT" log -1 --format=%s` содержит `Handoff:`? Если нет — отказать.
- Перейти к шагу 4 (cleanup).

### 6. Финал

Сообщить пользователю:
Про судьбу папки worktree подставить конкретику по факту шага 4:
- Если `worktree remove --force` прошёл — «Папка worktree удалена.»
- Если упал (Windows file lock) — назвать путь и дать команду:
  > Папка `<PROJECT_ROOT>` осталась на диске (file lock индексатора Windows держит её, пока открыта эта сессия). Удалится автоматически при следующем `/handoff-process`, либо вручную после закрытия сессии: `Remove-Item -Recurse -Force "<PROJECT_ROOT>"`.

```
═══ HANDOFF DONE ═══
Ветка <CURRENT_BRANCH> смержена в <BASE_BRANCH> и удалена.
Worktree: <удалена | папка <PROJECT_ROOT> осталась на диске, см. выше>.

Следующий шаг:
  Если эта задача сгенерировала handoff-requests (setup-project / new-topics / request-shared-edit):
    → Открой <MAIN_WT> в новой сессии БЕЗ worktree → /handoff-process

  Если это была чистая per-task работа (seo-statya / fix-article без правок общих файлов):
    → Ничего больше не нужно, файлы уже в main.

Эту сессию Claude Code можно закрывать.
═══════════════════
```

## Запреты

- Не запускай `/handoff` в main — нечего мерджить.
- Не игнорируй pre-commit ошибки через `--no-verify` без понимания, что делаешь.
- Не используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
