# Smoke-тесты `/seo-struktura`

Регрессионные тесты для скриптов скила (Этап 2 добавил единый slug-модуль и финальный гейт):
- `_slug.mjs` - единый модуль транслита + построения URL/id + валидации URL (чистые функции, без фикстур)
- `select-top10.mjs` - фильтрация JM + детекция каннибализации
- `build-structure-xlsx.mjs` - сборка A6.xlsx (4 листа, instruction row, data validation)
- `import-structure.mjs` - парсинг возвращённого клиентом xlsx (exit 0 / 3 / 4)
- `verify-structure.mjs` - механический финальный гейт структуры (exit 0 / 1 / 2 / 3)

## Что они проверяют

| # | Тест | Что валидируется |
|---|---|---|
| 1 | `select-top10.mjs runs and writes outputs` | exit 0, оба JSON созданы |
| 2 | `select-top10 detected expected cannibalization` | конфликт «под ключ» между страницами 1 и 2 пойман |
| 3 | `select-top10 filtered competitor brand` | запрос с брендом из `A3.md` (`evil-competitor.ru`) отфильтрован |
| 4 | `select-top10 filters navigational query (5.1)` | навигационные запросы («официальный сайт», «ооо») вырезаны |
| 5 | `select-top10 keeps base-only query exact=0,base>=10 (5.2)` | B2B-запрос с exact=0/base>=10 не теряется |
| 6-11 | `build-structure-xlsx.mjs ...` | A6.xlsx: 4 листа, dropdown на «Нужна?», «Примечания» без жаргона, commerce-пометки |
| 12 | `slug: URL из маркера, скобки вырезаны, <=60 симв и <=5 слов` | `buildPageUrl` (юнит) - баг гигантского URL закрыт на корню |
| 13 | `build-structure-xlsx: адрес n=5 короткий, из маркера, без скобок` | то же через полный пайплайн - страница-ловушка n=5 |
| 14 | `slug: коллизия -> осмысленная дифференциация / числовой суффикс` | `buildPageUrl` разводит совпавшие slug-и |
| 15 | `slug: URL сохраняет предлог «под»` | вердикт стратега #2 - «под ключ» не режется |
| 16 | `build-structure-xlsx: адрес n=2 ... содержит «pod»` | то же через полный пайплайн (фикстура n=2) |
| 17 | `slug: slugifyBase сохраняет старое поведение id` | id-ключ `decisions.json` не сдвигается (5 эталонных строк, посчитанных вручную по старой логике) |
| 18 | `дрейф-гард: карта транслита есть только в _slug.mjs` | `build-structure-xlsx.mjs`/`select-top10.mjs` не дублируют карту |
| 19 | `validateUrl: ловит кириллицу/скобки/двойной слэш/дефис/длину` | юнит-тест валидатора URL |
| 20 | `import-structure: кириллический адрес -> exit 3 + url_issue` | клиентский кириллический URL помечен, не чинится молча |
| 21 | `import-structure: чистые латинские адреса -> без URL-нарушений` | нет ложных срабатываний на нормальных адресах |
| 22 | `import-structure.mjs all yes -> exit 0` | все «да» возвращают exit 0, stats.yes=5 (4 исходные + фикстура-ловушка n=5) |
| 23 | `import-structure.mjs mixed -> exit 3` | смесь «обсудить»/«нет»/«да» возвращает exit 3 |
| 24 | `import-structure.mjs all empty -> exit 4` | пустая колонка возвращает exit 4 |
| 25-29 | `hierarchy: ...` | секционированная структура (use_sections + товарный category) - колонки, значения, round-trip |
| 30 | `verify-structure: полный консистентный A6 -> exit 0` | все проверки (URL/полнота/дубли маркеров) чистые |
| 31 | `verify-structure: пропала целевая страница -> exit 2` | пропажа страницы в A6.md - блок, имя страницы в выводе |
| 32 | `verify-structure: дубль маркера на 2 целевых страницах -> exit 2` | инвариант «один маркер = одна страница» |
| 33 | `verify-structure: кириллица в НОВОМ URL -> exit 2` | новый/генерируемый адрес с нарушением - блок |
| 34 | `verify-structure: кириллица в СУЩЕСТВУЮЩЕМ URL -> exit 1` | реальный клиентский IDN-адрес - warn, не блок |
| 35 | `verify-structure: битый вход (нет A6.md) -> exit 3` | ошибка запуска - код 3 (не 2) |

## Как запустить

Из корня проекта:

```
.claude\scripts\_node.cmd .claude\tests\seo-structure\run.mjs
```

Ожидаемый вывод (~5-10 секунд):

```
=== /seo-struktura scripts smoke ===
Sandbox: <project>/.claude/tmp/seo-structure-test

  [test] select-top10.mjs runs and writes outputs ... PASS
  ...
  [test] verify-structure: битый вход (нет A6.md) -> exit 3 ... PASS

=== 35/35 tests passed ===
```

Exit 0 = всё ок. Exit 1 = хоть один тест упал (вывод покажет где).

## Когда запускать

- После любых правок в `_slug.mjs`, `select-top10.mjs`, `build-structure-xlsx.mjs`, `import-structure.mjs`, `verify-structure.mjs`.
- Перед PR / push.
- При обновлении версий зависимостей (`exceljs`).

## Где лежат fixtures

```
.claude/tests/seo-structure/fixtures/
├── analyses/999-test/
│   ├── competitors.json   # 2 конкурента, leader.ru = лидер
│   └── A3.md              # стоп-лист с evil-competitor.ru (для теста фильтра)
├── structure_dir/         # основной поток: select-top10 -> build-structure-xlsx -> import-structure
│   ├── inputs.json
│   ├── master_list.json   # 5 страниц: главная + 2 услуги + инфо + n=5 фикстура-ловушка «Сепараторы
│                           # (центробежные, факельные - уточнить у клиента)» (регресс гигантского URL)
│   ├── markers.json        # маркеры для 4 (info без маркера); n=3 commerce_note=info_dominant;
│                           # n=5 маркер «сепаратор центробежный» (для slug-регрессии)
│   └── semantic_pack.json # JM-результаты с намеренным дублем «под ключ» (каннибализация), брендом
│                           # «evil-competitor.ru» (фильтр) и n=5 (маркер + 2 добора)
├── hierarchy_dir/          # секционированная структура (use_sections + товарный category)
└── verify_dir/              # статичная фикстура для verify-structure.mjs (не через пайплайн - агент
    ├── structure_data.json  # structure-writer не вызывается в тестах): n=1 Главная, n=2 Ремонт
    ├── master_list.json     # квартир (status «новая»), n=3 Ремонт ванной (status «существующая» -
    └── A6.md                 # имитирует реальный адрес клиента), n=4 Доставка (отложена)
```

## Как добавить новый тест

Открой `run.mjs`, найди раздел `=== ... ===`, добавь блок:

```js
step("моя проверка", () => {
  // вернуть true/undefined - PASS, строку с ошибкой - FAIL
  if (что-то не так) return "что именно";
  return true;
});
```

Юнит-тесты чистых функций `_slug.mjs` (без фикстур) - через динамический импорт:

```js
const { buildPageUrl, buildSlug, slugifyBase, validateUrl } = await import(slugModuleUrl);
```
