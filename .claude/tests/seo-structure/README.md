# Smoke-тесты `/seo-struktura`

Регрессионные тесты для скриптов скила (Этап 2 добавил единый slug-модуль и финальный гейт):
- `_slug.mjs` - единый модуль транслита + построения URL/id + валидации URL (чистые функции, без фикстур)
- `select-top10.mjs` - фильтрация JM + детекция каннибализации
- `build-structure-xlsx.mjs` - сборка A6.xlsx (4 листа, instruction row, data validation)
- `import-structure.mjs` - парсинг возвращённого клиентом xlsx (exit 0 / 3 / 4)
- `verify-structure.mjs` - механический финальный гейт структуры (exit 0 / 1 / 2 / 3)
- `validate-project-input.mjs` - вход структуры (шаг 1a): контракт анализа `sites/NNN/project.json`, тир-гейт по `queue.json.tier`, `keyso_base` / `region_yandex` / `domain` для `inputs.json` (exit 0 / 1 / 2). Заменил `validate-analysis-inputs.mjs`, его тесты из `tests/seo-analiz` (блоки 4-5) переехали сюда в части входа структуры

## Что они проверяют

| # | Тест | Что валидируется |
|---|---|---|
| 1 | `select-top10.mjs runs and writes outputs` | exit 0, оба JSON созданы |
| 2 | `select-top10 detected expected cannibalization` | конфликт «под ключ» между страницами 1 и 2 пойман |
| 3 | `select-top10 filtered competitor brand` | запрос с брендом из `stop_list.md` папки структуры (`evil-competitor.ru`) отфильтрован |
| 4 | `select-top10 filters navigational query (5.1)` | навигационные запросы («официальный сайт», «ооо») вырезаны |
| 5 | `select-top10 keeps base-only query exact=0,base>=10 (5.2)` | B2B-запрос с exact=0/base>=10 не теряется |
| 6-8, 11-13 | `build-structure-xlsx.mjs ...` | A6.xlsx: 4 листа, dropdown на «Нужна?», «Примечания» без жаргона, commerce-пометки |
| 9 | `A6.xlsx лист «Конкуренты» берет competitors.json из папки структуры` | лист «Конкуренты» читает выход seo-base из `structure_dir`, лидер помечен, фолбэк `pages_in_base` жив |
| 10 | `select-top10 без stop_list.md -> exit 0` | нет стоп-листа - фильтр брендов молчит, скрипт не падает |
| 14 | `slug: URL из маркера, скобки вырезаны, <=60 симв и <=5 слов` | `buildPageUrl` (юнит) - баг гигантского URL закрыт на корню |
| 15 | `build-structure-xlsx: адрес n=5 короткий, из маркера, без скобок` | то же через полный пайплайн - страница-ловушка n=5 |
| 16 | `slug: коллизия -> осмысленная дифференциация / числовой суффикс` | `buildPageUrl` разводит совпавшие slug-и |
| 17 | `slug: URL сохраняет предлог «под»` | вердикт стратега #2 - «под ключ» не режется |
| 18 | `build-structure-xlsx: адрес n=2 ... содержит «pod»` | то же через полный пайплайн (фикстура n=2) |
| 19 | `slug: slugifyBase сохраняет старое поведение id` | id-ключ `decisions.json` не сдвигается (5 эталонных строк, посчитанных вручную по старой логике) |
| 20 | `дрейф-гард: карта транслита есть только в _slug.mjs` | `build-structure-xlsx.mjs`/`select-top10.mjs` не дублируют карту |
| 21 | `validateUrl: ловит кириллицу/скобки/двойной слэш/дефис/длину` | юнит-тест валидатора URL |
| 22 | `import-structure: кириллический адрес -> exit 3 + url_issue` | клиентский кириллический URL помечен, не чинится молча |
| 23 | `import-structure: чистые латинские адреса -> без URL-нарушений` | нет ложных срабатываний на нормальных адресах |
| 24 | `import-structure.mjs all yes -> exit 0` | все «да» возвращают exit 0, stats.yes=5 (4 исходные + фикстура-ловушка n=5) |
| 25 | `import-structure.mjs mixed -> exit 3` | смесь «обсудить»/«нет»/«да» возвращает exit 3 |
| 26 | `import-structure.mjs all empty -> exit 4` | пустая колонка возвращает exit 4 |
| 27-31 | `hierarchy: ...` | секционированная структура (use_sections + товарный category) - колонки, значения, round-trip |
| 32 | `verify-structure: полный консистентный A6 -> exit 0` | все проверки (URL/полнота/дубли маркеров) чистые |
| 33 | `verify-structure: пропала целевая страница -> exit 2` | пропажа страницы в A6.md - блок, имя страницы в выводе |
| 34 | `verify-structure: дубль маркера на 2 целевых страницах -> exit 2` | инвариант «один маркер = одна страница» |
| 35 | `verify-structure: кириллица в НОВОМ URL -> exit 2` | новый/генерируемый адрес с нарушением - блок |
| 36 | `verify-structure: кириллица в СУЩЕСТВУЮЩЕМ URL -> exit 1` | реальный клиентский IDN-адрес - warn, не блок |
| 37 | `verify-structure: битый вход (нет A6.md) -> exit 3` | ошибка запуска - код 3 (не 2) |
| 38 | `vpi: валидный контракт по номеру -> exit 0 + JSON для inputs.json` | `project_path`, `structure_dir`, `keyso_base`, `region_yandex` числом, `domain` хостом; `analysis_dir` нет |
| 39 | `vpi: поиск по слагу и по пути каталога; --out` | номер, слаг и путь находят проект; `--out` пишет файл, stdout пуст |
| 40 | `vpi: тир-гейт queue.tier=basic -> exit 2` | «SEO не куплено (tier=basic)» + подсказка `queue.mjs init <slug> --tier seo`, inputs.json не пишется |
| 41 | `vpi: в queue.json tier нет, в project.json seo -> exit 2` | источник тарифа - только ответ оператора |
| 42 | `vpi: tier нет нигде -> exit 2` | лазейки «анализ без tier идет как legacy» нет |
| 43 | `vpi: tier в контракте отстал -> exit 0` | queue seo при project basic: предупреждение и `tier_lagging: true` |
| 44 | `vpi: гейт анализа не согласован -> exit 0` | предупреждение, `project_gate: false` |
| 45 | `vpi: контракт не проходит схему -> exit 2` | тот же обход схемы, что у verify-data; путь поля и лишний ключ в отчете |
| 46 | `vpi: пустой регион / пустые assortment+directions / дубль id -> exit 2` | структуре не на чем строить |
| 47 | `vpi: нет project.json или нет проекта -> exit 2` | подсказка `/site-analiz` |
| 48 | `vpi: регион вне баз Keyso и федеральный` | `msk` + `note_keyso`, `region_yandex` 213 + `note_region`, 225/0 не ставятся; Омск -> `oms` / 66 |
| 49 | `vpi: домен` | Punycode -> кириллица, соцсеть вместо сайта -> `null` с предупреждением, сайта нет -> `null` |
| 50 | `дрейф-гард: словарь verdict.type seo-base == structure-verifier` | четыре значения вердикта стоят в обоих агентах дословно, мертвых значений v7 нет (дефект Д5) |

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

=== 50/50 tests passed ===
```

Exit 0 = всё ок. Exit 1 = хоть один тест упал (вывод покажет где).

## Когда запускать

- После любых правок в `_slug.mjs`, `select-top10.mjs`, `build-structure-xlsx.mjs`, `import-structure.mjs`, `verify-structure.mjs`, `validate-project-input.mjs` (и схемы анализа `project.schema.json`).
- Перед PR / push.
- При обновлении версий зависимостей (`exceljs`).

## Где лежат fixtures

```
.claude/tests/seo-structure/fixtures/
├── sites/999-test/        # вход validate-project-input.mjs: валидный контракт v8 (СПб, сайт с www и путем)
│   ├── project.json
│   └── queue.json         # tier seo, гейт согласован
├── structure_dir/         # основной поток: select-top10 -> build-structure-xlsx -> import-structure
│   ├── inputs.json        # форма вывода validate-project-input.mjs (project_path, без analysis_dir)
│   ├── competitors.json   # выход seo-base: 2 конкурента, leader.ru = лидер
│   ├── stop_list.md       # выход seo-base: стоп-лист с evil-competitor.ru (для теста фильтра)
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
