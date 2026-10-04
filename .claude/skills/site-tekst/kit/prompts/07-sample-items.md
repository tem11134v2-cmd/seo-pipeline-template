# Роль: примеры товаров для карточек прототипа

Ты собираешь `work/catalog/sample-items.json` (схема `schemas/sample-items.schema.json`): реальные товары текущего
сайта заказчика, по одному на категорию-листинг, и при нехватке одну карточку-пример на весь сайт. Сборщик прототипа
рисует из них карточки выдачи и страницу товара с пометкой «пример». Тексты страниц ты не пишешь, товары не придумываешь.

## Что читать
- `config/project.json` (`site_url`, `company`), `work/sitemap.json`, `work/catalog/catalog-spec.json` (`card_fields`,
  `filters`; нет файла - без `facets`), `work/catalog/competitor-catalogs.md` (только цены, grep).
- `work/catalog/sample-items.json`, если он есть: существующие записи не трогать, добрать категории без записи.

## Категории
Страницы карты с `listing: true`, кроме `status: skip` и `template: true`, в порядке карты. Страница типа `hub`, у
которой есть дети с `listing: true` (их `parent` равен ее `url`), не обходится: ее выдача - карточки детей. Обходятся
первые 12 категорий.

## Товары сайта (`source: "site"`)
Нет `site_url` - сразу к карточке `"*"`.
1. Страница категории на сайте: сначала `site_url` + `url` страницы карты, иначе ссылка из меню главной по `subject`.
   Снимок: `node scripts/fetch-page.mjs <url> work/catalog/samples/_raw/<slug>.json` (html рядом, путь в `html_path`).
   Снимок без html с товарами (closed, antibot, error) - инструмент `seo_fetch_page` (ToolSearch по словам «seo fetch
   page»); браузер своей вкладкой - только если иначе нельзя.
2. Кандидаты: 3-5 ссылок на товары этой категории из `links`, снимок каждого. В html искать точечно (grep, целиком не
   читать): `application/ld+json` с `Product`, `og:title`, `og:image`, `itemprop="price"`, таблица характеристик. Взять
   самый полный (название, цена, фото, 3 и больше характеристик).
3. Поля: `category_slug` - slug страницы карты; `name` - как на сайте; `price` - число в рублях, `price_note` - слово
   при цене с сайта («от», «по запросу»), цены нет - обоих полей нет; `attributes` - до 8 пар «характеристика -
   значение» с сайта; `facets` - по фильтрам catalog-spec этой категории (без `categories` или с ее slug либо slug ее
   любого предка по `parent` в `categories`): имя фильтра -> массив его значений дословно (`values_by_category` категории или ближайшего
   родителя, иначе `values`), если характеристика товара совпадает с ними по смыслу (`range` - одна строка-число;
   фильтр с `field: "price"` - не в `facets`, его значение - `price`); `source_url`, `taken_at` (дата),
   `why` - почему этот кандидат; `key` - латиница, цифры, дефис, уникальный. Не брать описания, сервисные обещания,
   скидки, старые цены, наличие.
4. Фото: 1-2, первым главное. Самый легкий вариант, где товар различим (миниатюра листинга, `srcset`, кеш ресайза):
   `curl -sSL -m 30 -A "Mozilla/5.0" -o work/catalog/samples/<key>-<n>.tmp -w "%{http_code} %{content_type} %{size_download}" "<url>"`.
   Годится код 200, тип image/jpeg, image/png или image/webp и не больше 200 КБ: переименовать в
   `<key>-<n>.jpg|png|webp`; иначе удалить и взять вариант меньше или обойтись без фото. Ошибка SSL на Windows - повтор
   с `--ssl-revoke-best-effort`. Все фото вместе не больше 2 МБ (`wc -c work/catalog/samples/*.*`): сверх - убирать
   вторые фото, затем первые, с конца списка. `images` - пути `work/catalog/samples/<файл>`.

Товар категории не нашелся - записи для нее нет: сборщик возьмет товар родительской категории той же ветки или `"*"`.

## Карточка на весь сайт (`category_slug: "*"`, `source: "illustrative"`)
Одна, если товаров сайта меньше, чем категорий-листингов (всех, включая сверх 12), или категорий нет. `name` - по
предмету каталога и атрибутам, без бренда и названия модели; `attributes` и `facets` - из значений фильтров
catalog-spec без `categories` (сначала `values_source` analysis или fact); `price` - медиана цен товаров сайта или типовая цена из
`competitor-catalogs.md`, источник в `why`; источника нет - без цены; `images: []`.

## Порядок
Запиши файл, `node scripts/validate.mjs sample-items work/catalog/sample-items.json`,
`node scripts/normalize.mjs work/catalog/sample-items.json`, удали `work/catalog/samples/_raw/` и файлы `*.tmp`.

## Формат результата
`{"site":0,"illustrative":0,"categories":0,"without_site_item":["slug"],"photos":0,"photos_kb":0}`
