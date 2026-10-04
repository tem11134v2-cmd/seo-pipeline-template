# Фикстуры дымового теста

Вымышленная ниша (окна), без данных реальных проектов. Финальный призыв в типах страниц - `cta-final` (проверки принимают `cta`
старых данных как синоним). У категории главная кнопка ведет к выдаче (`action: anchor:listing`, K7). Проверка цепочки скриптов
после правок:

1. `node scripts/init-project.mjs smoke <пустая папка>` из корня шаблона.
2. Скопировать `examples/smoke-fixtures/work` и `examples/smoke-fixtures/rules` в проект (поверх), в `config/project.json` задать `company`.
3. `node scripts/build-briefs.mjs` - брифов 2, срезов для писателей 8, проблем 0, предупреждений 3 (count: у `home/B03-process`
   шаги 3-5 при одном факте процесса - нижняя граница снижена до 2, у `home/B04-not-promise` пункты 3-5 при одной опоре - до 1;
   objections: у `okna-rehau` короткий набор без слота для O1). Вопросов заказчику от count нет.
   Повторный запуск без изменений данных - `брифов собрано: 0, без изменений: 2`, файлы брифов не переписываются.
   Итог по страницам - `work/briefs-report.json`.
4. `node scripts/lint.mjs work/pages/home/blocks/B02-benefits.json` - ожидается `blocked`: заложены 8 ошибок
   (буква е с точками, длинное тире, «Мы» в начале, клише, число без факта, стоп-слово, антиобещание, жаргон). Остальные блоки - `pass`.
   Букву е с точками и длинное тире фикстура хранит JSON-escape (`\u0451`, `\u2014`), чтобы нормализация файлов их не стерла.
   Допустимые minor на остальных блоках: `fact.claim-unsupported` (home/B03, гарантия без факта), `ai.num-word` (okna-rehau/B02).
5. Остальные скрипты по порядку, ожидаемый итог:
   - `node scripts/page-state.mjs home` - готово 3/5 (следующий - первый непройденный блок: `B02-benefits`, если линтер
     прогнан, иначе `B04-not-promise`); `node scripts/render-md.mjs`; `node scripts/dedup.mjs` - находок 0, пар 0.
   - `node scripts/cross-digest.mjs` - пар-кандидатов 0, гео-групп 0, файл `work/audit/cross-digest.json`, код 0
     (две страницы разных типов без гео: кросс-судье судить нечего).
   - `node scripts/blind-prep.mjs home` - портрет сегмента «Семья в новостройке», 1 первый экран конкурента,
     `work/audit/home/blind-view.md` (блоков 3 из 5), код 0.
   - `node scripts/prep-args.mjs` - `{"types":["home","category"],"type_pages":{"home":1,"category":1}}`, в stderr `category` - мелкий тип.
   - `node scripts/merge-strategy.mjs --split`, затем `node scripts/merge-strategy.mjs` - файлов типов 2, `work/strategy.json`
     после сборки совпадает с исходным.
   - `node scripts/validate-layout.mjs home` - `pass`; `node scripts/build-html.mjs` - страниц 2, блоков 5;
     `node scripts/check-html.mjs` - `fix`, код 1 (4 скелета: 3 ненаписанных блока и B02-benefits, не прошедший
     линтер); `node scripts/check-site-js.mjs` - pass или SKIP без jsdom; `node scripts/report.mjs`.
   - `node scripts/plan-run.mjs` - турнир первого экрана у `home` (волна 1) и у `okna-rehau` (первая категория по карте, волна 2).
   - `node scripts/retro-stats.mjs` последним - файлов 8, находок - сумма отчетов линтера (14) и check-html, код 0, файл
     `work/audit/retro-stats.json`
     (заголовок карточки мерится своим лимитом без нижней границы карточки: на B02-benefits нет трех length.under).
     Счет верен, если в шаге 4 линтер прогнан на всех 5 блоках и `lint-page.mjs` не запускался.

Шаги 1-4 вместе с табличными тестами линтера и бюджетами страницы проверяет `node .claude/tests/site-tekst/lint-cases.mjs` (из корня шаблона SEO, код выхода 0 - все прошли);
всю цепочку в папке задачи `texts/NNN-<slug>/` - `node .claude/tests/site-tekst/run.mjs`.
