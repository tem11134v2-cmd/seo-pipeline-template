---
name: handoff
description: Сливает worktree обратно в main и удаляет worktree. Запускается в конце задачи (статья / аудит / etc) из worktree-сессии.
---

# handoff

Закрывает worktree-задачу: коммит → merge в main → удаление ветки → удаление worktree.

## Аргументы

```
/handoff [--message "<сообщение коммита>"] [--resume]
```

- `--message` — переопределить auto-message для финального коммита (если есть несохранённые изменения).
- `--resume` — продолжить handoff после ручного разрешения конфликта (см. ниже).

## Алгоритм

### 0. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` — мы в main, handoff не нужен. Сообщить и выйти:
> «Текущая сессия не в worktree. /handoff не нужен — все правки сразу в основной папке.»

### 1. Узнать параметры

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# MAIN_WT — основная рабочая копия (где .git — это директория, не файл-указатель)
COMMON_DIR_ABS=$(git rev-parse --git-common-dir)
# git может вернуть относительный путь или абсолютный
case "$COMMON_DIR_ABS" in
  /*|[a-zA-Z]:*) ;;
  *) COMMON_DIR_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR_ABS" && pwd) ;;
esac
MAIN_WT=$(dirname "$COMMON_DIR_ABS")

# Определить базовую ветку (master или main — зависит от init.defaultBranch)
# Берём текущую ветку main-worktree
BASE_BRANCH=$(git -C "$MAIN_WT" rev-parse --abbrev-ref HEAD)
# Если main-worktree оказалась на нашей же branch — это аномалия, отказать
if [ "$BASE_BRANCH" = "$CURRENT_BRANCH" ]; then
  echo "Ошибка: main worktree на той же ветке, что и текущая ($CURRENT_BRANCH). Аномалия, /handoff отказывает."
  exit
fi
```

Сообщить пользователю:
> «Handoff: worktree `<CURRENT_BRANCH>` → `<BASE_BRANCH>` в `<MAIN_WT>`».

### 2. Auto-commit несохранённого

Если `git status --porcelain` непуст:

1. Определить сообщение коммита:
   - Если передан `--message` → использовать его
   - Иначе: прочитать `.claude/tmp/current-task.txt`, найти `meta.json` в этой папке, взять `state` и название темы. Сообщение: `<task-slug>: <state>`. Например: `001-seo-prodvizhenie: assembled`.
   - Если ничего не нашли: `WIP from <CURRENT_BRANCH>`.

2. `git add -A && git commit -m "<сообщение>"`.

   Pre-commit hook проверит белый список путей. Если что-то вне зоны — handoff остановится, попросит пользователя:
   > «Нашёл изменения вне задачи. Используй /request-shared-edit для общих файлов или вынеси их в отдельный коммит --no-verify, потом /handoff снова.»

### 3. Merge в main

```bash
git -C "$MAIN_WT" checkout "$BASE_BRANCH"
git -C "$MAIN_WT" merge "$CURRENT_BRANCH" --no-ff -m "Handoff: $CURRENT_BRANCH"
```

Если merge упал в конфликт:
- Сообщить пользователю:
  > «Конфликт при merge. Файлы с конфликтом: [список из `git status`].
  > Открой папку проекта `<MAIN_WT>` в отдельной сессии без worktree, разреши конфликты вручную, сделай `git commit`.
  > Затем вернись сюда и запусти `/handoff --resume` — я доделаю удаление ветки и worktree.»
- **Остановиться, не удалять ничего.**

Если merge прошёл — продолжить.

### 4. Удаление worktree и ветки

⚠️ **Порядок критичен:** сначала worktree, потом ветка. Git не даст удалить ветку, пока её использует worktree.

⚠️ **Используем `--force`:** в worktree всегда остаются untracked файлы из `.gitignore` (`.claude/tmp/current-task.txt`, `node_modules/` и т.п.), git без `--force` откажет. Это безопасно — untracked файлы по определению вне версионирования.

```bash
# Сначала удалить worktree (с --force, т.к. в .claude/tmp/ всегда что-то untracked)
git -C "$MAIN_WT" worktree remove --force "$PROJECT_ROOT"

# Потом удалить ветку
git -C "$MAIN_WT" branch -d "$CURRENT_BRANCH"
```

Если `worktree remove --force` упал с ошибкой (типичный случай на Windows — `Permission denied`, файлы держит индексатор/антивирус):
- Это **не критично**, если merge уже прошёл (шаг 3) — данные в main.
- Попробовать `git -C "$MAIN_WT" worktree prune` — очистит git-метаданные worktree, даже если папка на диске не удалилась.
- Затем `git -C "$MAIN_WT" branch -d "$CURRENT_BRANCH"`.
- Сообщить пользователю:
  > «Merge выполнен, ветка удалена, но файлы worktree остались на диске (`<путь>`). Это безопасно — git их больше не отслеживает. Можешь удалить папку руками, когда Claude Code закроет хендлы.»

### 5. (--resume) Альтернативная ветка

Если запущен с `--resume`:
- Пропустить шаги 2-3 (коммит и merge уже сделаны пользователем).
- Проверить, что merge действительно завершён: `git -C "$MAIN_WT" log -1 --format=%s` должен содержать `Handoff:`. Если нет — отказать с сообщением.
- Перейти к шагу 4.

### 6. Финал

Сообщить:
```
═══ HANDOFF DONE ═══
Ветка <branch> смержена в main и удалена.
Worktree <path> удалена.
Файлы задачи теперь в основной папке проекта: <MAIN_WT>
Эту сессию Claude Code можно закрывать.
═══════════════════
```

## Запреты

- Не запускай `/handoff` в main (нечего сливать).
- Не игнорируй pre-commit ошибки через `--no-verify` без понимания, что делаешь.
- Не используй длинное тире (—) и среднее (–). Только дефис (-).
