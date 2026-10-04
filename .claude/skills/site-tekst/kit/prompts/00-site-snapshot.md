# Роль: снимок публичных данных компании с ее сайта

Ты дополняешь `work/facts.json` -> `company` контактами и реквизитами с живого сайта компании там, где анализ их не дал.
Живой сайт - не источник фактов о продукте и не образец текста. Берем только: юрлицо, ИНН, ОГРН, адрес, телефоны,
почту, часы, каналы.

## Что читать
- `config/project.json` -> `site_url`. `work/facts.json` -> `company`, `gaps`.
- `work/import-report.json` -> `company_missing`, если файл есть (режим project: какие поля пусты).

## Что сделать
1. Заполняешь только пустые поля `company`, в том числе при `status: confirmed`: заполненные поля и `status: confirmed`
   не трогаешь. `company.no_phone: true` - заказчик без телефона: телефоны не бери; поля из `company.absent` заказчик
   велел убрать - их не заполняй. `brand` и `channels` из анализа дополняй, не затирай (каналы со старого сайта скрипт
   шага 5 уносит в вопросы заказчику). `site_url` пуст - шаги 2-3 пропусти, строка в `gaps`: «адреса сайта нет».
2. Главная и страница контактов - разными файлами: `node scripts/fetch-page.mjs <site_url> work/competitors/raw/_own/home.json`,
   ссылку на контакты найди в `links` главной (контакт, contact), затем `... work/competitors/raw/_own/contacts.json`.
   Реквизиты и контакты ищи в `footer_text`, в `sections` и `grep -F` по `html_path` (tel:, mailto:, ИНН, ОГРН, ссылки
   мессенджеров). Статус `closed`, `antibot` или `error` - открой страницу в браузере своей вкладкой, возьми текст оттуда.
3. Заполни пустые поля: `legal_name`, `inn`, `ogrn`, `address`, `phones` (как на сайте, основной первым), `email`, `hours`,
   `channels` - ссылки мессенджеров и соцсетей строками-URL (`{"whatsapp":"https://wa.me/..."}`), `source` - URL страницы
   (было значение - допиши « + <URL>»). `status`: был `missing` - `from_site_unconfirmed`, иначе не меняй. Данные на
   сайте расходятся (два юрлица, два графика) - все варианты через « / » и строка в `gaps`: «реквизиты: на сайте
   расходятся ...».
4. Кроме `company` и `gaps` в `facts.json` ничего не меняй. Строку «реквизиты: в анализе нет ...», которую оставил
   импорт, замени итогом снимка (что нашлось, чего нет).
5. Последний шаг - всегда, даже если ничего не нашлось: `node scripts/import-project.mjs --company-facts` (единый формат
   телефонов, каналы-объекты, служебные факты F901-F907), затем `node scripts/validate.mjs facts work/facts.json`.

## Формат результата
`{"status":"confirmed|from_site_unconfirmed|missing","fields_filled":[""],"discrepancies":[""],"source_urls":[""],"company_facts":[""]}`
`company_facts` - id служебных фактов из вывода `--company-facts`.
