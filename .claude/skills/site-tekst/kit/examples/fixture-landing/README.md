# Фикстура: лендинг

Одна рабочая страница (главная), вымышленная компания. Меню нет: якоря шапки только из `config.site.nav`
(`{label, anchor}` - id блока типа). Ссылки блоков на страницы вне прототипа (`/uslugi/`, `/materialy/`) выводятся текстом,
кнопки ведут к блоку-форме. Готовые `brief.json`, блоки и `lint-*.json` (pass). Тесты - `.claude/tests/site-tekst/cases-site.mjs` и `cases-kf-site.mjs`
(оболочка КФ лендинга; без `work/shell.json` сборка сверяется с эталоном `fixtures/site-golden/fixture-landing.*.html` - после
намеренной правки фикстуры эталон обновляет `node .claude/tests/site-tekst/fixtures/site-golden/golden.mjs`).
