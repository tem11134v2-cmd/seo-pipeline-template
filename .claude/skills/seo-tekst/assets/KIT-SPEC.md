# KIT-SPEC - контракт сборки HTML-прототипа

> Внутренний спек для `build-prototype.mjs` и набора ассетов (kit).
> Источник истины для слотов фрагментов, токенов темы и маркеров shell.
> Менять синхронно: `build-prototype.mjs` <-> `fragments/*` <-> `fragments-manifest.json`.

Прототип собирается **детерминированно** скриптом `build-prototype.mjs` из:
- `manifest.json` (что собрать: тема + блоки с текстом + опции) - его готовит агент `prototype-builder`
- набора **ассетов** (как собрать: shell + css + js + фрагменты + темы) - этот kit

LLM пишет ТЕКСТ и принимает решения (какой блок, какой фрагмент, какая тема).
Скрипт занимается ШАБЛОНИЗАЦИЕЙ. CSS/JS никогда не редактируются LLM.

---

## 1. Файлы kit (всё в `assets/`)

```
PROTOTYPE-MASTER.html       # shell-каркас всего документа (head+body+legal/thanks секции)
prototype.css               # компонентный CSS (использует токены темы, без хардкода брендовых цветов)
prototype.js                # вся интерактивность (формы, FAQ, бургер, попапы, cookie, hash-router)
arrow.svg                   # SVG-стрелка-загогулина к кнопке Hero
fragments-manifest.json     # карта тип-блока -> файл фрагмента + слоты + repeatables + опции
fragments/<type>.html       # HTML-фрагмент одного блока со слотами
themes/theme-<niche>.css    # :root{} токены палитры + шрифт под нишу
legal/footer.html           # футер с реквизитами + ссылками на юр-страницы
legal/cookie-banner.html    # баннер cookie
legal/page-privacy.html     # секция «Политика конфиденциальности» (роутится по #privacy)
legal/page-consent.html     # секция «Согласие на обработку ПДн» (#person-data-consent)
legal/page-cookie.html      # секция «Политика cookie» (#cookie)
legal/page-thanks.html      # секция «Спасибо» (#thanks)
```

---

## 2. manifest.json (вход build-prototype.mjs)

Готовит `prototype-builder`. Один манифест = одна страница = один прототип.

```json
{
  "meta": {
    "project": "akva-spb",
    "slug": "ustanovka-septikov",
    "page_type": "Услуга",
    "title": "Установка септиков в СПб - монтаж под ключ за 1 день",
    "description": "<= 160 символов для <meta description>"
  },
  "theme": "b2b",
  "legal": {
    "company": "ООО Аква-Сервис",
    "inn": "[ИНН - требует уточнения]",
    "ogrn": "[ОГРН - требует уточнения]",
    "address": "[ЮР_АДРЕС - требует уточнения]",
    "domain": "akva-spb.ru",
    "email": "info@akva-spb.ru",
    "phone": "+7 (812) 000-00-00",
    "date": "06.06.2026"
  },
  "blocks": [
    {
      "type": "hero",
      "fragment": "hero",
      "h2": null,
      "slots": { "h1": "...", "subhead": "...", "cta_label": "Рассчитать стоимость",
                 "bonus": "+ выезд замерщика бесплатно",
                 "plates": [ {"title":"...","text":"..."}, {"title":"...","text":"..."}, {"title":"...","text":"..."} ] },
      "opts": { "arrow": true },
      "fill_notes": []
    },
    {
      "type": "advantages",
      "fragment": "cards",
      "h2": "Почему монтаж под ключ выгоднее",
      "slots": { "items": [ {"title":"...","text":"..."}, {"title":"...","text":"..."}, {"title":"...","text":"..."} ] },
      "opts": { "cols": 3 },
      "fill_notes": []
    }
  ]
}
```

Правила:
- `blocks[].type` - смысловой тип блока (из BLOCKS.md). `blocks[].fragment` - какой HTML-фрагмент рендерить (обычно совпадает или из fragments-manifest).
- `slots` - значения для `{{...}}` плейсхолдеров фрагмента. Массивы -> repeatable-регионы.
- `opts` - модификаторы (варианты вёрстки/классы): `cols` (3/4), `featured` (индекс выделенного тарифа), `arrow` (bool), `inverted` (bool, тёмный блок - только cta-mid, максимум 1-2).
- `fill_notes` - пометки `[ЗАПОЛНИТЬ: ...]` для согласования (выводятся отдельным списком, в HTML идут как `data-fill`).
- **Ровно одна форма захвата в финале** (`type:"form"` встречается 1 раз). Pre-footer = микро-конверсия, не дубль формы.

`page.json` (вход для docx-сборки, готовит `page-writer`) - то же `blocks[]` с текстом, но БЕЗ `fragment/opts/theme/legal` (чистая копирайт-копия для Google Doc). `prototype-builder` дополняет его до `manifest.json`.

---

## 3. Синтаксис фрагмента

Простой mini-template (реализован в build-prototype.mjs, без зависимостей):

| Конструкция | Значение |
|---|---|
| `{{slot}}` | подстановка скалярного слота (HTML-escape по умолчанию) |
| `{{{slot}}}` | подстановка без escape (для уже готового HTML, напр. ссылки) |
| `<!--REPEAT:items-->...{{item.title}}...<!--/REPEAT:items-->` | повтор региона по массиву `slots.items`, внутри `{{item.<field>}}` |
| `<!--IF:opts.arrow-->...<!--/IF:opts.arrow-->` | условный регион по truthy `opts.arrow` |
| `<!--CLASS:cols-->` | подставит `cols-3`/`cols-4` из `opts.cols` (хелпер для вариативных классов) |
| `{{@index}}` | порядковый индекс внутри REPEAT (с 1) |

Неизвестный слот -> пустая строка + предупреждение в лог (не падать). Слот в `fill_notes` -> рендерится как `<span class="nx-fill" data-fill="...">[ЗАПОЛНИТЬ: ...]</span>`.

---

## 4. Полный пример фрагмента: `fragments/hero.html`

```html
<section class="pt-hero" id="hero">
  <div class="container pt-hero__grid">
    <div class="pt-hero__text">
      <h1 class="pt-hero__h1">{{h1}}</h1>
      <p class="pt-hero__sub">{{subhead}}</p>
      <div class="pt-hero__cta-wrap">
        <a href="#lead" class="btn btn--primary pt-hero__cta">{{cta_label}}</a>
        <!--IF:opts.arrow--><span class="pt-arrow" aria-hidden="true"><!--ARROW_SVG--></span><!--/IF:opts.arrow-->
      </div>
      <!--IF:bonus--><p class="pt-hero__bonus">{{bonus}}</p><!--/IF:bonus-->
    </div>
    <div class="pt-hero__plates">
      <!--REPEAT:plates-->
      <div class="pt-plate">
        <div class="pt-plate__title">{{item.title}}</div>
        <div class="pt-plate__text">{{item.text}}</div>
      </div>
      <!--/REPEAT:plates-->
    </div>
  </div>
</section>
```

Соответствующая запись `fragments-manifest.json`:

```json
{
  "hero": {
    "file": "hero.html",
    "scalars": ["h1", "subhead", "cta_label", "bonus"],
    "repeatables": { "plates": ["title", "text"] },
    "opts": ["arrow"],
    "notes": "1 кнопка (не 2), SVG-стрелка, 3 плашки title+1 строка. H1 44px. Без дисклеймеров."
  }
}
```

---

## 5. Токены темы (`themes/theme-<niche>.css`)

Каждая тема - только `:root{}` блок + шрифт. Единый словарь токенов (одинаковый во всех темах, чтобы `prototype.css` работал с любой):

```css
:root{
  --font: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --bg:#ffffff; --bg-alt:#f6f8fb; --bg-invert:#0f172a;
  --text-primary:#0f172a; --text-secondary:#5b6b80; --text-invert:#ffffff;
  --accent-primary:#1f6feb; --accent-secondary:#0b3d91;
  --border:#e3e8ef; --radius:14px; --shadow:0 6px 24px rgba(15,23,42,.08);
}
```

Ниши (6): `premium`, `b2b`, `mass-services`, `ecommerce`, `saas`, `military-dark`. Значения - из DESIGN-SYSTEMS источника. build-prototype.mjs линкует `themes/theme-<manifest.theme>.css` в `<head>` ПЕРЕД `prototype.css`.

---

## 6. Shell (`PROTOTYPE-MASTER.html`) - маркеры

build-prototype.mjs заменяет HTML-комментарии-маркеры:

| Маркер | Чем заменяется |
|---|---|
| `<!--META_TITLE-->` | `<title>` + og |
| `<!--META_DESC-->` | `<meta name=description>` |
| `<!--THEME_CSS-->` | `<style>` содержимое выбранной темы (инлайнится, чтобы файл был self-contained) |
| `<!--PROTOTYPE_CSS-->` | `<style>` содержимое prototype.css |
| `<!--BLOCKS-->` | конкатенация отрендеренных фрагментов блоков по порядку |
| `<!--FOOTER-->` | legal/footer.html со слотами реквизитов |
| `<!--LEGAL_PAGES-->` | legal/page-*.html секции (роутятся по hash) |
| `<!--COOKIE_BANNER-->` | legal/cookie-banner.html |
| `<!--PROTOTYPE_JS-->` | `<script>` содержимое prototype.js |
| `<!--ARROW_SVG-->` | содержимое arrow.svg (внутри hero, если opts.arrow) |

Итог - **один self-contained .html** (инлайн `<style>`+`<script>`, без внешних запросов, без фреймворков) - совместим с Tilda Zero Block / WordPress.

---

## 7. POST-FLIGHT ассерты (в verify-prototype.mjs)

- есть `<header>`, ровно один `<form>` (финал), `<footer>`, `tel:`-ссылка, cookie-баннер;
- нет фреймворковых атрибутов (`class="...react"`, `v-`, `ng-`, `data-tilda`);
- submit формы `disabled` по умолчанию + чекбокс согласия (`#f-agree`) - короткая формулировка (v4: одна строка, без дублирования надписи кнопки);
- бюджеты символов блоков в допуске (±15% от BLOCKS.md);
- нет длинного/среднего тире (— –), только дефис;
- стоп-формулы (COPY.md) не встречаются;
- H1 содержит маркер; все `fill_notes` собраны в отчёт.
