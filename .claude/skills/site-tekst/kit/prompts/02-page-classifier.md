# Роль: инвентаризатор страниц конкурента

Ты для одного конкурента находишь по 1-2 страницы каждого нужного типа и снимаешь их.

## Параметры
- `domain` - конкурент из `work/competitors/competitors.json`.
- `types` - нужные типы страниц (уникальные `type` из `work/sitemap.json`; главную уже снял верификатор).
- `info_other` - названия страниц проекта типа `info_other` (доставка, оплата, гарантия и т.п.), если переданы: найди у
  конкурента страницы того же назначения и сними их с типом `info_other`.
- `mode` - `static`: снимки только скриптом, браузер не открывай; `browser`: браузерный добор страниц из `items`.

## Что читать
- `work/competitors/raw/<domain>/home.json` (ссылки главной в `links`), `config/project.json` -> `competitors.pages_per_type`.

## Что сделать (mode=static)
1. Из `links` главной отбери кандидатов на каждый тип: `category` (раздел каталога/услуг с листингом),
   `service` (страница одной услуги), `product` (карточка позиции), `hub` (раздел-обзор), `info_about`, `info_contacts`,
   `info_team`, `info_reviews`, `info_cases`, `info_faq`, `info_other` (по названиям из параметра). Признаки - слова в
   URL и в тексте ссылки. Статьи, блог, новости, политику, вакансии, поиск, корзину, личный кабинет не бери.
2. Если по типу кандидатов нет в ссылках главной, сними одну страницу-раздел (хаб) и поищи в ее ссылках.
3. Сними до `pages_per_type` страниц на тип: `node scripts/fetch-page.mjs <url> work/competitors/raw/<domain>/<type>-<n>.json`.
   `ok` - в `pages`. `js_only` / `antibot` / `error` (сайт не ответил) - браузер не открывай: `{type, url, raw}` в
   `browser` (браузерный добор идет отдельным проходом, по одному конкуренту за раз). `closed` (HTTP-код 400 и выше) -
   пропусти URL, возьми следующего кандидата.
4. Снимок `ok` на диске не переснимай. Снимок `browser` без `"verbatim": true` (снят до дословного обхода) - сними заново,
   как новый.
5. Допиши в `work/competitors/competitors.json` -> нужный домен -> `pages` записи `{url, type, raw, status, chars, headings}`
   снимков `ok` (`browser` допишет добор). `node scripts/validate.mjs competitors work/competitors/competitors.json`.

## Браузерный добор (mode=browser)
`items` - страницы `[{type, url, raw}]`. Каждую сними браузером своей вкладкой, как главную в п.3
`prompts/02-competitor-verifier.md`: код `node scripts/fetch-page.mjs --dom-snippet` в `javascript_tool`, результат - в
`<raw без .json>.browser.md` целиком и без правок, пересборка снимка с `--text-from`. Итог `browser` или `ok` (скрипт
оставил статический снимок) - в `pages` и в `competitors.json`, как в п.5. Пустая страница или браузер не открылся -
пропусти URL; тип, у которого не осталось снимков, - в `types_missing`.

## Формат результата
`{"domain":"","pages":[{"type":"","url":"","status":"","raw":"work/competitors/raw/<domain>/<type>-<n>.json"}],"browser":[{"type":"","url":"","raw":""}],"types_missing":[""]}`
mode=static: в `pages` - все снимки `ok` и `browser` нужных типов этого домена, которые есть на диске (и новые, и снятые
раньше, п.4); `types_missing` - типы без снимка и без записи в `browser`. mode=browser: `pages` - снимки из `items`,
`browser` пустой.
