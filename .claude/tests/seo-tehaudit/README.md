# Smoke-тесты `/seo-tehaudit` (Этап 4)

Регрессионные тесты доработки Этапа 4 (пороги on-page проверок в коде вместо промпта,
факт-чек `audit_data.json` против источников):

- `merge-onpage.mjs` (Пакет 1, Блок A) - merge пересчитывает per-page вердикты по
  числовым порогам (`TH.TITLE_MAX/DESC_MAX/H1_MAX`) из сырых полей `sample[]`
  (`title_len/desc_len/h1_count`), а не доверяет вердикту агента-шарда. Заполняет
  `sample[].issues` (backward-compat для `audit-writer`). Переносит `extra_findings`
  агента (нештатные находки вне числовых порогов) в `problems` с дедупликацией против
  пересчитанного.
- `verify-audit.mjs` (Пакет 2, Блок B) - карточка (состав и порядок 22 строк по эталону
  §5.5 `audit-writer.md`) + `meta_table.rows[].schema` как строка, не массив/объект.

Агентская проза (`audit-onpage.md`, `audit-verifier.md`) тестами не покрывается - она
не детерминирована и проверяется вручную/ревью (см. чек-лист ревьюера в спеке Этапа 4).

## Устойчивость к параллельной разработке

`merge-onpage.mjs` и `verify-audit.mjs` УЖЕ существуют на момент старта Этапа 4 (Пакеты
1-2 их только правят - это не новые файлы, как было с `_questions.mjs` в Этапе 3).
Поэтому тесты выполняются **всегда**, без SKIP-веток по существованию файла.

Тесты Блока A рассчитаны на НОВОЕ поведение merge (пересчет порогов из `TH`, дедуп
`extra_findings`). При прогоне ДО имплементации Пакета 1 они закономерно **FAIL** - это
ожидаемо: тесты - контракт Пакета 1, а не диагностика существующего кода.

`run.mjs` - общий файл для Пакетов 1 и 2 (без пересечения по фикстурам): **Пакет 1
владеет файлом** и создает скелет + Блок A; **Пакет 2 дописывает Блок B** в конец файла,
сразу после маркера `БЛОК B: verify-audit.mjs ...` (используя те же хелперы
`step/runScript/readJson/writeJson/freshDir` и свою фикстуру `fixtures/verify_dir/`,
не пересекающуюся с `fixtures/merge_dir/`). Финальный блок подсчета PASS/FAIL и очистки
sandbox должен остаться последним в файле.

## Что они проверяют

| # | Тест | Что валидируется |
|---|---|---|
| 1 | `happy-path: merge-onpage.mjs merge_dir -> exit 0` | базовый прогон не падает, `onpage.json` создан |
| 2-3 | `Title: 81 символ -> флаг` / `80/79 -> НЕТ флага` | граница `TH.TITLE_MAX=80` (`>` строго, не `>=`) |
| 4 | `Title: пустой (0) -> критичный флаг` | `title_len===0` -> `critical` «Title не заполнен» |
| 5-6 | `Description: 201 -> флаг` / `200/199 -> НЕТ флага` | граница `TH.DESC_MAX=200` |
| 7 | `Description: пустой (0) -> критичный флаг` | `desc_len===0` -> `critical` «Description не заполнен» |
| 8-9 | `H1: 2 -> критичный флаг` / `0 -> критичный флаг` | `h1_count>TH.H1_MAX` и `h1_count===0`, оба `critical` |
| 10 | `H1: 1 -> НЕТ флага` | норма (ровно один H1) не флагуется |
| 11 | `issues: заполнен на каждой строке` | backward-compat - `merge`, а не агент, ставит `issues` |
| 12-13 | `issues: чистая -> "-"` / `проблемная -> непустой тег` | содержимое тега соответствует найденным проблемам |
| 14 | `extra_findings: дубликат агента НЕ задвоен` | находка агента, дублирующая пересчитанную (тот же url + смысл заголовка, другой регистр/слеш) - схлопывается, не дает вторую запись в `problems` |
| 15 | `extra_findings: нештатная находка - ПРИСУТСТВУЕТ` | находка вне числовых порогов (не дублирует пересчитанное) - переносится в `problems` как есть |
| 16 | `onpage.json: схема не изменилась` | все поля верхнего уровня (`sample_source, sample, title_placeholder, url_structure, favicon, schema_summary, problems, ok_items, mcp_errors`) на месте - `audit-writer` читает без правок |

Тесты Блока B (`verify-audit.mjs`, Пакет 2):

| # | Тест | Что валидируется |
|---|---|---|
| 19 | `happy-path: verify-audit.mjs verify_dir -> exit 0` | валидный `audit_data.json` (22 строки карточки в порядке §5.5, `meta_table.rows[].schema` - строки, counts согласованы) проходит без ошибок |
| 20 | `карточка: сломанный порядок -> exit 2` | переставлены местами `Тематика`/`CMS` (позиции 2-3) - позиционное сравнение с `CARD_LABELS` ловит нарушение порядка |
| 21 | `карточка: пропавшая строка -> exit 2` | удалена одна из 22 строк (`Шаблон`) - длина `card` не совпадает с эталоном |
| 22 | `meta_table.rows[0].schema - массив -> exit 2` | `schema` не склеена в строку (осталась массивом) - ловится отдельно от карточки |
| 23 | `регрессия: counts.critical != длине critical_problems -> exit 2` | существующая проверка (до Этапа 4) не сломана новыми правками |

## Как эталон карточки (`CARD_LABELS`) держится синхронно

`verify-audit.mjs` сравнивает `card[].label` с константой `CARD_LABELS` через `normLabel`
(ё->е, тире->дефис, схлопывание пробелов, регистр не важен) - фикстура
`fixtures/verify_dir/audit_data.json` намеренно использует оригинальные метки
`audit-writer.md` §5.5 с буквой ё (`Исключённых страниц`, `Возраст счётчика`), чтобы
тест заодно проверял саму нормализацию, а не только точное совпадение строк.

## Как запустить

Из корня проекта (PowerShell или `_node.cmd` напрямую - обычный `node` может не быть
в `PATH` в Claude Code Desktop):

```
.claude\scripts\_node.cmd .claude\tests\seo-tehaudit\run.mjs
```

Ожидаемый вывод (Блоки A+B, после Пакетов 1 и 2; ~1-2 секунды):

```
=== /seo-tehaudit (Этап 4) scripts smoke ===
Sandbox: <project>/.claude/tmp/seo-tehaudit-test

=== merge-onpage.mjs (Пакет 1) ===
  [test] happy-path: merge-onpage.mjs merge_dir -> exit 0, onpage.json создан ... PASS
  ...
  [test] onpage.json: схема не изменилась (audit-writer читает без правок) ... PASS
=== verify-audit.mjs (Пакет 2) ===
  [test] happy-path: verify-audit.mjs verify_dir -> exit 0 (карточка/schema валидны) ... PASS
  ...
  [test] регрессия: counts.critical != длине critical_problems -> exit 2 ... PASS

=== 23/23 tests passed (0 skipped) ===
```

Exit 0 = все выполненные тесты прошли. Exit 1 = хоть один тест упал (вывод покажет,
какой именно, и что он ожидал/получил).

## Где лежат fixtures

```
.claude/tests/seo-tehaudit/fixtures/
├── merge_dir/               # merge-onpage.mjs: шард с граничными случаями
│   ├── page_plan.json       #   минимальный - url_structure пустой (все []), sample_source="sitemap"
│   └── onpage_1.json        #   агент-стиль шард: sample[] на 13 страниц + extra_findings
│                             #   - title-81/80/79, title-0 (пустой)
│                             #   - desc-201/200/199, desc-0 (пустой)
│                             #   - h1-2/0/1
│                             #   - clean (полностью чистая - issues=="-")
│                             #   - / (Главная, favicon:true на уровне шарда)
│                             #   - extra_findings: 1 дубликат (схлопывается с перерасчетом),
│                             #     1 нештатная находка (переносится как есть)
└── verify_dir/               # verify-audit.mjs: валидный audit_data.json (не пересекается с merge_dir/)
    └── audit_data.json       #   22 строки карточки в порядке §5.5 (с ё, как в оригинале
                               #   audit-writer.md - проверяет normLabel), counts согласованы,
                               #   meta_table.rows[].schema - строки, ссылки appendix валидны.
                               #   Тесты 20-23 мутируют копию в sandbox (порядок/длина карточки,
                               #   schema-массив, counts-рассинхрон) - сам файл остаётся эталоном.
```

## Как добавить новый тест

Открой `run.mjs`, найди блок `=== ... ===`, добавь:

```js
await step("моя проверка", () => {
  // вернуть true/undefined - PASS, строку с ошибкой - FAIL, SKIP("причина") - SKIP
  if (что-то не так) return "что именно";
  return true;
});
```

Хелперы уже в файле: `runScript(script, ...args)` - запуск `.mjs` через `_node.cmd`;
`readJson`/`writeJson` - чтение/запись JSON с BOM-safe парсингом; `freshDir(dir,
fixtureSubdir)` - копия фикстуры в sandbox перед мутацией; `findProblem(problems,
title, detailsIncludes)` / `countProblem(...)` - поиск/подсчет записи в `problems[]` по
заголовку и подстроке в `details` (обычно url); `rowByUrl(sample, url)` - поиск строки
`sample[]` по url.
