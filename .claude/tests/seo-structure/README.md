# Smoke-тесты `/seo-struktura`

Регрессионные тесты для трёх скриптов скила:
- `select-top10.mjs` - фильтрация JM + детекция каннибализации
- `build-structure-xlsx.mjs` - сборка A6.xlsx (4 листа, instruction row, data validation)
- `import-structure.mjs` - парсинг возвращённого клиентом xlsx (exit 0 / 3 / 4)

## Что они проверяют

| # | Тест | Что валидируется |
|---|---|---|
| 1 | `select-top10.mjs runs and writes outputs` | exit 0, оба JSON созданы |
| 2 | `select-top10 detected expected cannibalization` | конфликт «под ключ» между страницами 1 и 2 пойман |
| 3 | `select-top10 filtered competitor brand` | запрос с брендом из `A3.md` (`evil-competitor.ru`) отфильтрован |
| 4 | `build-structure-xlsx.mjs runs and creates A6_test.xlsx` | файл сгенерирован без ошибок |
| 5 | `A6.xlsx has 4 sheets in correct order` | Структура / Рекомендации / Конкуренты / Миграция |
| 6 | `A6.xlsx pipes commerce_warning to «Примечания»` | страница с `commerce_note=info_dominant` в `markers.json` имеет красный жирный текст в «Примечаниях» |
| 7 | `A6.xlsx instruction row + headers at row 2 + data validation` | первая строка = инструкция клиенту, заголовки в строке 2, dropdown на колонке «Целевая?» |
| 8 | `import-structure.mjs all yes -> exit 0` | все «да» возвращают exit 0, stats.yes=4 |
| 9 | `import-structure.mjs mixed -> exit 3` | смесь «обсудить»/«нет»/«да» возвращает exit 3 |
| 10 | `import-structure.mjs all empty -> exit 4` | пустая колонка возвращает exit 4 |

## Как запустить

Из корня проекта:

```
.claude\scripts\_node.cmd .claude\tests\seo-structure\run.mjs
```

Ожидаемый вывод (~5 секунд):

```
=== /seo-struktura scripts smoke ===
Sandbox: <project>/.claude/tmp/seo-structure-test

  [test] select-top10.mjs runs and writes outputs ... PASS
  ...
  [test] import-structure.mjs all empty -> exit 4 ... PASS

=== 9/9 tests passed ===
```

Exit 0 = всё ок. Exit 1 = хоть один тест упал (вывод покажет где).

## Когда запускать

- После любых правок в `select-top10.mjs`, `build-structure-xlsx.mjs`, `import-structure.mjs`.
- Перед PR / push.
- При обновлении версий зависимостей (`exceljs`).

## Где лежат fixtures

```
.claude/tests/seo-structure/fixtures/
├── analyses/999-test/
│   ├── competitors.json   # 2 конкурента, leader.ru = лидер
│   └── A3.md              # стоп-лист с evil-competitor.ru (для теста фильтра)
└── structure_dir/
    ├── inputs.json
    ├── master_list.json   # 4 страницы: главная + 2 услуги + инфо
    ├── markers.json       # маркеры для 3 (info без маркера); n=3 имеет commerce_note=info_dominant
                            # для теста проброса commerce_warning в xlsx
    └── semantic_pack.json # JM-результаты с намеренным дублем «под ключ» (для теста каннибализации)
                            # и запросом с брендом «evil-competitor.ru» (для теста фильтра)
```

## Как добавить новый тест

Открой `run.mjs`, найди раздел `=== Тест ... ===`, добавь блок:

```js
step("моя проверка", () => {
  // вернуть true/undefined - PASS, строку с ошибкой - FAIL
  if (что-то не так) return "что именно";
  return true;
});
```
