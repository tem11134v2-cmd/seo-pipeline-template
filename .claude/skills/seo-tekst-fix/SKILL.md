---
name: seo-tekst-fix
description: Точечная правка готового прототипа страницы из /seo-tekst. Разбирает запрос (вкл. голосовые - «что понял/что неясно/что не трогаю»), правит manifest, пересобирает prototype.html, возвращает дифф. Аргументы - <NNN> <page-slug> "<правка>" (или <NNN> "<правка>" если страница одна).
---

# seo-tekst-fix

Точечная правка готового HTML-прототипа. Запускается **в worktree-сессии**. Скелет - как `/fix-article`: разрешить цель -> делегировать фиксеру -> вернуть дифф (не весь файл). Делегат - агент `prototype-fixer` (порт PHASE-7 + паттерн article-fixer).

## Аргументы
```
/seo-tekst-fix <NNN> [<page-slug>] "<описание правки>"
```
- `<NNN>` - номер задачи `texts/NNN-*/`.
- `<page-slug>` - какая страница; если в задаче одна страница - можно опустить.
- `"<правка>"` - описание (может быть расшифровкой голосового, сумбурной).

## Алгоритм
1. **Проверка worktree** (как в /seo-tekst, предупредить если main).
2. Найти `texts/<NNN>-*/`. Если `page-slug` не задан и страниц несколько - спросить какую. Записать `.claude/tmp/current-task.txt = texts/<NNN>-*/`.
3. Убедиться, что `pages/<slug>/manifest.json` и `prototype.html` существуют (иначе подсказать сначала прогнать /seo-tekst).
4. Делегировать `prototype-fixer`: `texts_dir`, `page_slug`, `fix_description`. (expected-маркер `pages/<slug>/prototype.html` - один файл, hook штатно проверит.)
5. Фиксер сам разбирает запрос (при неясности - спросит ДО правки), правит manifest, пересобирает (`build-prototype.mjs` + `verify-prototype.mjs`), возвращает дифф.

   5a. Если фиксер вернул "полная переделка - нужен page-writer": проверь `texts/<NNN>/blueprints/<slug>.json`. Нет (задача создана до ADR-020) - сначала делегируй `block-planner` (texts_dir, project_root, mode), он создаст `blueprints/`. Затем `page-writer` (texts_dir, project_root, page_slug, mode, page_url для mode B) -> `copy-auditor` + `verify-copy.mjs` -> `prototype-builder` (`build-prototype.mjs` + `verify-prototype.mjs`).
6. Финальный коммит:
```bash
git add -A && git commit -m "Tekst <NNN> fix (<slug>): <короткое описание>"
```
7. Вывести дифф + что проверено. Подсказать: ещё правка `/seo-tekst-fix ...` или `/handoff`.

## Запреты
- Пиши только в `texts/<NNN>/pages/<slug>/`. Kit и чужие страницы - read-only. (Исключение: ветка полной переделки 5a может создать `texts/<NNN>/blueprints/` через block-planner - это внутри папки задачи, pre-commit пропустит.)
- Согласованные блоки не трогать без переспроса (правило anti-rollback).
- Длинное/среднее тире (— –) запрещено - дефис (-).
