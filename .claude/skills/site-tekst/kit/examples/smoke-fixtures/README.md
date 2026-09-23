# Фикстуры дымового теста

Вымышленная ниша (окна), без данных реальных проектов. Проверка цепочки скриптов после правок:

1. `node scripts/init-project.mjs smoke <пустая папка>` из корня шаблона.
2. Скопировать `examples/smoke-fixtures/work` и `examples/smoke-fixtures/rules` в проект (поверх), в `config/project.json` задать `company`.
3. `node scripts/build-briefs.mjs` - брифов 2, срезов для писателей 8, проблем 0.
4. `node scripts/lint.mjs work/pages/home/blocks/B02-benefits.json` - ожидается `blocked`: заложены 8 ошибок
   (буква е с точками, длинное тире, «Мы» в начале, клише, число без факта, стоп-слово, антиобещание, жаргон). Остальные блоки - `pass`.
   Букву е с точками и длинное тире фикстура хранит JSON-escape (`\u0451`, `\u2014`), чтобы нормализация файлов их не стерла.
   Допустимые minor на остальных блоках: `fact.claim-unsupported` (home/B03, гарантия без факта), `ai.num-word` (okna-rehau/B02).
5. Остальные скрипты по порядку, ожидаемый итог:
   - `node scripts/page-state.mjs home` - готово 3/5; `node scripts/render-md.mjs`; `node scripts/dedup.mjs` - находок 0, пар 0.
   - `node scripts/cross-digest.mjs` - пар-кандидатов 0, гео-групп 0, файл `work/audit/cross-digest.json`, код 0
     (две страницы разных типов без гео: кросс-судье судить нечего).
   - `node scripts/blind-prep.mjs home` - портрет сегмента «Семья в новостройке», 1 первый экран конкурента,
     `work/audit/home/blind-view.md` (блоков 3 из 5), код 0.
   - `node scripts/prep-args.mjs` - `{"types":["home","category"],"type_pages":{"home":1,"category":1}}`, в stderr `category` - мелкий тип.
   - `node scripts/merge-strategy.mjs --split`, затем `node scripts/merge-strategy.mjs` - файлов типов 2, `work/strategy.json`
     после сборки совпадает с исходным.
   - `node scripts/validate-layout.mjs home` - `pass`; `node scripts/build-html.mjs` - страниц 2, блоков 5;
     `node scripts/check-html.mjs` - `fix`, код 1 (3 ненаписанных блока); `node scripts/report.mjs`.
   - `node scripts/plan-run.mjs` - `home` с `hero_mode: tournament`, `okna-rehau` с `single`.
   - `node scripts/retro-stats.mjs` последним - файлов 8, находок 20 (lint 17, html-check 3), код 0, файл `work/audit/retro-stats.json`.
     Счет верен, если в шаге 4 линтер прогнан на всех 5 блоках и `lint-page.mjs` не запускался.

Шаги 1-4 вместе с табличными тестами линтера и бюджетами страницы проверяет `node .claude/tests/site-tekst/lint-cases.mjs` (из корня шаблона SEO, код выхода 0 - все прошли);
всю цепочку в папке задачи `texts/NNN-<slug>/` - `node .claude/tests/site-tekst/run.mjs`.
