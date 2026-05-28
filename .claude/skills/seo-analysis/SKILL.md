---
name: seo-analysis
description: Полный цикл предпроектного анализа конкурентов для SEO. Бриф клиента → структурирование → поиск конкурентов → SERP-вердикт → скан смыслов топ-3 → A2.md (5 разделов) + A3.md (стоп-лист) + опц. .docx. Аргументы: [путь к файлу с брифом ИЛИ ничего] [--resume].
---

# seo-analysis

Скил-оркестратор предпроектного анализа конкурентов. Запускается **в worktree-сессии**. Проходит state machine от парсинга брифа до финальных A2.md/A3.md и опционально .docx для клиента.

> Полная сборка алгоритма — на этапе 6 реализации. Сейчас это черновик-каркас, описывающий контракт и зоны ответственности.

## Аргументы

```
/seo-analysis [--resume]
```

- Без аргументов — скил спросит, передаст ли пользователь бриф текстом в чат или путь к файлу.
- `--resume` — продолжить с того места, где остановились (по `meta.json`).

## State machine

```
init → brief-done → competitors-done → serp-done → leaders-done → report-done → [docx-done] → completed
```

`docx-done` — опциональное состояние. Если пользователь после `report-done` не запрашивает .docx, скил сразу переходит в `completed`.

`meta.json` — единственный источник истины о текущем состоянии. Обновляется через `.claude/hooks/update-meta.sh <analysis_dir> <state>`.

## Артефакты

```
analyses/NNN-<domain-slug>/
├── meta.json              # state machine
├── brief_raw.txt          # исходный бриф (как пришёл от пользователя)
├── brief.json             # 16 параметров + keyso_base + region_id + путь А/Б/В/Г
├── candidates.json        # 15+ доменов-кандидатов до фильтрации (intermediate)
├── competitors.json       # 6-10 финальных + топ-3 лидера + причины исключений
├── serp.json              # SERP-анализ + вердикт + промежуточный стоп-лист + смежные
├── leader_scan.json       # блоки/посылы/фишки по топ-3 + сводка с сопоставлением
├── A2.md                  # ФИНАЛ — markdown-отчёт (5 разделов)
├── A3.md                  # ФИНАЛ — стоп-лист (по строке = домен)
└── A2_<slug>.docx         # опц. финал для клиента (шаг 7)
```

## Алгоритм (каркас, детали в этапе 6)

1. **0a.** Проверка `git rev-parse --git-dir` vs `--git-common-dir`. Если main — предупредить.
2. **0b.** Parse args (`--resume` или фрэш-старт).
3. **1. Setup.** Запросить бриф у пользователя (если нет `--resume`). Сохранить как `analyses/NNN-<slug>/brief_raw.txt`. Записать `current-task.txt`. Создать `meta.json` (state=init).
4. **2. Брифование (state=init).** Делегировать `brief-structurer` → `brief.json`. State → `brief-done`.
5. **3. Конкуренты (state=brief-done).** Делегировать `competitor-finder` → `candidates.json` + `competitors.json`. State → `competitors-done`.
6. **4. SERP-вердикт (state=competitors-done).** Делегировать `serp-verdict` → `serp.json`. State → `serp-done`. Пауза для пользователя если вердикт `КОРРЕКТИРУЕМ` или `МЕНЯЕМ`.
7. **5. Скан смыслов (state=serp-done).** Делегировать `leader-scanner` → `leader_scan.json`. State → `leaders-done`.
8. **6. Сборка A2 + A3 (state=leaders-done).** Делегировать `analysis-writer` → `A2.md` + `A3.md`. State → `report-done`. Спросить пользователя: «Сгенерировать .docx для клиента?»
9. **7. (Опц.) .docx (state=report-done и пользователь сказал «да»).** `.claude\scripts\_node.cmd .claude\scripts\build-analysis-docx.mjs <analysis_dir>` → `A2_<slug>.docx`. State → `docx-done`.
10. **8. Финал.** State → `completed`. Финальный коммит. Вывести пользователю пути к артефактам и напоминание про `/handoff`.

## Запреты

- НЕ писать результаты в корень проекта (только в `<analysis_dir>/`).
- НЕ редактировать общие файлы (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`).
- НЕ пропускать состояния — каждое `update-meta.sh` обязательно.
- НЕ использовать длинное тире (—) и среднее (–). Только дефис (-).
- НЕ запускать `/write-article`, `/strategy`, `/new-topics` из этой же сессии — отдельные worktree-задачи.
